<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
require_once("category.php");
require_once("topic.php");
require_once("function.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id']))
	redirect_to('login.php');

$categories = Category::find_all(); 

if(isset($_POST['submit'])){

	$required_fields = array('category_id', 'topic_title');
	$errors = array();

	foreach($required_fields as $required_field){
		if(!isset($_POST[$required_field]) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field])))
			$errors[] = $_POST[$required_field] . ' is a required field.';
	}


	if(empty($errors) && ($_FILES['video']['error'] == 0)){

		$cid = mysql_real_escape_string((htmlspecialchars($_POST['category_id']));
		$des = mysql_real_escape_string((htmlspecialchars($_POST['description']));
		$tt = mysql_real_escape_string((htmlspecialchars($_POST['topic_title']));
		$filename = $_FILES['video']['name'];
		$filetype = $_FILES['video']['type'];
		$filesize = $_FILES['video']['size'];
		$filetmpname = $_FILES['video']['tmp_name'];

		$newTopic = Topic::newTopic($cid, $des, $tt, $_SESSION['user_id'],$filename, $filesize, $filetype, $filetmpname);
		move_uploaded_file($newTopic->temp_name, "/Applications/XAMPP/xamppfiles/htdocs/ToastmasterLibrary/videos/" . $newTopic->name);		

		if($newTopic->save()){
			redirect_to("settings.php");
		} else {
			die("Cannot create topic." . mysql_error());
		}	
	} else {
		foreach($errors as $error){
			echo '</br>' . $error . '</br>';
		} 
		echo '</br>' . $_FILES['video']['error'] . '</br>';
	}
}
	

?>


<form action="uploadTopic.php" enctype="multipart/form-data" method="post" id="uploadTopicForm">
	<legend>New Topic</legend>
	<fieldset>
		<label for="categories">Category:</label>
		<select id="categories" name="category_id">
			<?php
				foreach($categories as $category){
					echo "<option value=\"" . $category->id . "\">" . $category->category_title . "</option></br>";
				}
			?>
		</select></br>
		<label for="topic_title">Topic Title:</label>
		<input id="topic_title" name="topic_title" type="text"/></br>
		<?php
			echo "<input id=\"topic_creator\" type=\"hidden\" name=\"topic_creator\" value=\"" . $_SESSION['user_id'] . "\"></input>";
		?>
		<label for="speechDate">Date of Speech:</label>
		<input type="text" id="datepicker" class="hasDatepicker" name="speechDate"/></br>
		<label for="description">Description:</label>
		<textarea id="description" name="description" placeholder="Enter a topic description:"/></br>
		<label for="video">Select Video:</label>
		<input type="file" id="video" name="video"/></br>
		<input type="hidden" id="submit2" name="submit"/>
		<input id ="topicSubmitButton" name="submit" type="submit" value="submit"/></br>
		</fieldset>
</form>

<?php
include_once("footer.php");
?>
<script>
$( "#datepicker" ).datepicker();
</script>


<script>
	$( ".speechDate" ).datepicker( "show" );
	$('#addEditTopicsBlock').unbind();
	$('#addEditTopicsBlock').on("click","#topicSubmitButton", function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('adding topic');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var title = $('form[id="uploadTopicForm"] #topic_title').val();

		if(title == ''){
			valid += '<p> A title is required. </p>';
		}

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
			$("#registerErrorMessages").removeAttr('style');
			$("#registerErrorMessages").fadeOut(2000);
		} else {
			submitTopic();
		}
	});

	function submitTopic(){
		$('form[id="uploadTopicForm"]').ajaxSubmit({
			type:'POST',
			url: 'uploadTopic.php',
			//data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Topic added!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#settingsControls").load("topicALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				//alert('error');
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Topic could not be deleted.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="uploadTopicForm"]')[0].reset();
			}
		});
	};
</script>