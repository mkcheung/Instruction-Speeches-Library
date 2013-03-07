<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
require_once("category.php");
include_once("header.php");

$errors = array();
$required_fields = array('category_title', 'category_description');



if(isset($_POST['categoryId'])){
	$categoryId = $_POST['categoryId'];     
	$category = Category::find_by_id($categoryId);

	echo "<div id=\"registerErrorMessages\"></div>" ;
	echo "<form action=\"editCategory.php\" method=\"post\" id=\"editCategoryForm\">" ;
	echo "<legend>Edit Category:</legend>" ;
	echo "<input type=\"hidden\" id=\"submit2\" name=\"submit\"/>";
	echo "<input type=\"hidden\" id=\"id\" name=\"id\" value=\"" . $category->id . "\"/> </br>";
	echo "Title:<input type=\"text\" id=\"category_title\" name=\"category_title\" value=\"" . $category->category_title . "\"/> </br>";
	echo "Description:<input type=\"text\" id=\"category_description\" name=\"category_description\" value=\"" . $category->category_description . "\"/> </br>";
	echo "<input id=\"editCategorySubmit\" type=\"submit\" name=\"submit\" class=\"btn btn-primary\"/>";
	echo "</form>";	

} else if (isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){
		$id = mysql_real_escape_string($_POST['id']);
		$ct = mysql_real_escape_string($_POST['category_title']);
		$cd = mysql_real_escape_string($_POST['category_description']);


		$newCategory = Category::newCategory($ct, $cd);
		$newCategory->id = $id;
		if($newCategory->save()){
			redirect_to("categoryListing.php");
		} else {
			die("Could not edit category. " . mysql_error());
		}
	} else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
	}
}

?>

<?php
include_once("footer.php");
?>
<script>

	$('#addEditCategoriesBlock').unbind();
	$('#addEditCategoriesBlock').on("click","#editCategorySubmit", function(e){

		e.preventDefault();
		e.stopPropagation();
//		alert('18');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var title = $('form[id="editCategoryForm"] #category_title').val();
		var description = $('form[id="editCategoryForm"] #category_description').val();

		if(title == ''){
			valid += '<p> A title is required. </p>';
		}	
		if(description == ''){
			valid += '<p> A description is required. </p>';
		}	

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
		} else {
			registrationFormData = $('form[id="editCategoryForm"]').serialize();
			submitEditCategory(registrationFormData);
		}
	});

	function submitEditCategory(formData){
		$.ajax({
			type:'POST',
			url: 'editCategory.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Success!</div>');
				$("#settingsControls").load("categoryALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Ajax problems.</div>');
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="categorySubmit"]')[0].reset();
			}
		})
	};
</script>