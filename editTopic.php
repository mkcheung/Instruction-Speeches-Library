<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("category.php");
require_once("topic.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

	$required_fields = array('editTopic_categories', 'editTopic_topic_title');
	$errors = array();

	$categories = Category::find_all(); 
if(isset($_POST['topicId'])){


	$topicId = $_POST['topicId'];     
	$topic = Topic::find_by_id($topicId);

	$topics = Topic::find_all(); 
?>

<!-- Load existing values for examination -->
<!-- 
	Created a multidimensional js array. First index stores the id of the category. Second index is the array,
	with all titles associated with the specific category.
-->
<script>
	var currentTitle = '<?=$topic->topic_title?>';
	var editTopic_existingTitles = Array();

<?php 
	foreach($topics as $aTopic){
?>
	editTopic_existingTitles['<?=$aTopic->category_id?>'] = Array();
<?php
	}
?>

<?php 
	foreach($topics as $aTopic){
?>
	editTopic_existingTitles['<?=$aTopic->category_id?>'].push('<?=$aTopic->topic_title?>');
<?php
	}
?>
</script>
	<div id="registerErrorMessages"></div>
	<form action="editTopic.php" enctype="multipart/form-data" method="post" id="editTopicForm">
		<legend class="formTitle">Edit Topic:</legend>
		<fieldset>
			<input type="hidden" id="id" name="id" value="<?=$topic->id?>"/> 
			<label for="editTopic_categories">Category:</label>
			<select id="editTopic_categories" name="editTopic_categories">
			<?php
				foreach($categories as $category){
					if($topic->category_id == $category->id ){
			?>
						<option value="<?=$category->id?>" selected><?=$category->category_title?></option>
			<?php
					} else {
			?>
						<option value="<?=$category->id?>"><?=$category->category_title?></option>
			<?php
					}
				}
			?>
			</select>
			<label for="editTopic_topic_title">Topic Title:</label>
			<input id="editTopic_topic_title" name="editTopic_topic_title" class="text" type="text" value="<?=$topic->topic_title?>"/>
			<div style="color:red; font-size:12px;" class="validation"></div>
			<label for="editTopic_topic_date">Date of Speech:</label>
			<input class="text" type="text" id="editTopic_topic_date" class="hasDatepicker" name="editTopic_topic_date" value="<?=$topic->topic_date?>"/>
			<div style="color:red; font-size:12px;" class="validation"></div>
			
			<label for="editTopic_topic_description">Description:</label>
			<textarea class="text" id="editTopic_topic_description" name="editTopic_topic_description"><?=$topic->description?></textarea>
			<div style="color:red; font-size:12px;" class="validation"></div>
			<?php
				if($topic->isExample){
			?>
			Example: <input type="checkbox" id="isExample" name="isExample" value="<?=$topic->isExample?>" checked/>
			<?php } else {
			?>
			Example: <input type="checkbox" id="isExample" name="isExample" value="<?=$topic->isExample?>"/>
			<?php
				}
			?>
			<input id="topic_creator" type="hidden" name="topic_creator" value="<?=$_SESSION['user_id']?>"></input>

			<label for="video">Select Video:</label>
			<input type="file" id="video" name="video"/>
			<input type="hidden" id="submit2" name="submit"/>
			<input type="hidden" id="video_id" name="video_id" value="<?=$topic->video_id?>"/>
			<input type="hidden" id="video_name" name="video_name" value="<?=$topic->video_name?>"/>
			<input type="hidden" id="video_size" name="video_size" value="<?=$topic->video_size?>"/>
			<input type="hidden" id="video_type" name="video_type" value="<?=$topic->video_type?>"/>
			<input type="hidden" id="video_temp_name" name="video_temp_name" value="<?=$topic->video_temp_name?>"/>
			<div class="row-fluid">
				<div class='span6'>
					<input id="editTopicSubmit" name="submit" type="submit" value="submit"/>
					 <script>

						$('#editTopicForm #editTopic_categories').change(function(){
							var currentSelectedCategory = $(this).val();
							var topicTitle = $('#editTopicForm #editTopic_topic_title').val();
							var topicDate = $('#editTopicForm #editTopic_topic_date').val();
							var topicDescription = $('#editTopicForm #editTopic_topic_description').val();
							console.log(currentSelectedCategory);
							console.log(topicTitle);
							console.log(topicDescription);

							if(topicTitle.length == 0){
								// console.log('title required');
								$('#editTopic_topic_title').next('div[class="validation"]').text('A title is required.');
							} else if ((jQuery.inArray(topicTitle, editTopic_existingTitles[currentSelectedCategory]) >= 0) && (topicTitle != editTopic_existingTitles[currentSelectedCategory][(jQuery.inArray(currentTitle, editTopic_existingTitles[currentSelectedCategory]))])) {
								$('#editTopic_topic_title').next('div[class="validation"]').text('This title already exists for this category.');
							} else {
								$('#editTopic_topic_title').next('div[class="validation"]').text('');	
							}

							if(topicDate.length == 0){
								$('#editTopic_topic_date').next('div[class="validation"]').text('A topic date is required.');
							} else {
								$('#editTopic_topic_date').next('div[class="validation"]').text('');	
							}

							if(topicDescription.length == 0){
								$('#editTopic_topic_description').next('div[class="validation"]').text('A description is required.');
							} else {
								$('#editTopic_topic_description').next('div[class="validation"]').text('');	
							}

							// $('#editTopic_topic_title').val('');
							// $('#editTopic_topic_title').next().text('');
							// $('#editTopic_topic_description').val('');
							// $('#editTopic_topic_description').next().text('');
							// $('#editTopic_topic_date').val('');
							// $('#editTopic_topic_date').next().text('');
						});

						$('#editTopicForm input, #editTopicForm textarea').blur(function(){
							var id = $(this).attr('id');
							var value = $(this).val();
							var selectedCategoryId = $('#editTopic_categories').val();
							console.log(id);
							console.log(selectedCategoryId);
							console.log(jQuery.inArray(value, editTopic_existingTitles[selectedCategoryId]));
							// console.log(currentTitle);
							// console.log(editTopic_existingTitles[selectedCategoryId][(jQuery.inArray(value, editTopic_existingTitles[selectedCategoryId]))]);
							switch(id){
								case 'editTopic_topic_title' :
									if(value.length == 0){
										$(this).next('div[class="validation"]').text('A title is required.');
									} else if ((jQuery.inArray(value, editTopic_existingTitles[selectedCategoryId]) >= 0) && (value != editTopic_existingTitles[selectedCategoryId][(jQuery.inArray(currentTitle, editTopic_existingTitles[selectedCategoryId]))])) {
										// console.log('HERE');
										$(this).next('div[class="validation"]').text('This title already exists for this manual');
									} else {
										$(this).next('div[class="validation"]').text('');	
									}
									break;
								case 'editTopic_topic_date' :
									setTimeout(function(){
										var value = $('#editTopic_topic_date').val();
										// alert(value);
										if(value.length == 0){
											$('#editTopic_topic_date').next('div[class="validation"]').text('A topic date is required.');
										} else {
											$('#editTopic_topic_date').next('div[class="validation"]').text('');	
										}
									}, 30);
									break;
								case 'editTopic_topic_description' :
									if(value.length == 0){
										$(this).next('div[class="validation"]').text('A description is required.');
									} else {
										$(this).next('div[class="validation"]').text('');	
									}
									break;
								default: 
									break;
							}
						});
						$('#editTopicSubmit').unbind();
						$('#editTopicSubmit').click(function(e){
							e.preventDefault();
							e.stopPropagation();
					//		alert('18');

							var valid = '';
							var errorDisplay = '' ;
							var required = ' is required.';
							var title = $('form[id="editTopicForm"] #editTopic_topic_title').val();
							var date = $('form[id="editTopicForm"] #editTopic_topic_date').val();
							var description = $('form[id="editTopicForm"] #editTopic_topic_description').val();
							var selectedCategoryId = $('#editTopic_categories').val();

							console.log('title: ' + title);
							console.log('date: ' + date);
							console.log('description: ' + description);
							console.log('selectedCategoryId: ' + selectedCategoryId);
							
							if(title == ''){
								valid += '<p> A title is required. </p>';
								$('form[id="editTopicForm"] #editTopic_topic_title').next().text('A title is required.');
							} else if ((jQuery.inArray(title, editTopic_existingTitles[selectedCategoryId]) >= 0) && (currentTitle != editTopic_existingTitles[selectedCategoryId][(jQuery.inArray(title, editTopic_existingTitles[selectedCategoryId]))])) {
								// console.log('HERE');
								valid += '<p> This title already exists for this category. </p>';
								$('form[id="editTopicForm"] #editTopic_topic_title').next('div[class="validation"]').text('This title already exists for this category.');
							} else {
								$('form[id="editTopicForm"] #editTopic_topic_title').next('div[class="validation"]').text('');
							}

							if(date == ''){
								valid += '<p> A topic date is required. </p>';
								$('form[id="editTopicForm"] #editTopic_topic_date').next('div[class="validation"]').text('A topic date is required.');
							} else {
								$('form[id="editTopicForm"] #editTopic_topic_date').next('div[class="validation"]').text('');	
							}

							if(description == ''){
								valid += '<p> A description is required. </p>';
								$('form[id="editTopicForm"] #editTopic_topic_description').next('div[class="validation"]').text('A description is required.');
							} else {
								$('form[id="editTopicForm"] #editTopic_topic_description').next('div[class="validation"]').text('');	
							}

							if(valid.length > 0){
								$('div[class="alert alert-error"]').remove();
								$('div[class="alert alert-success"]').remove();
								errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
								$('#registerErrorMessages').append(errorDisplay);
								$('#registerErrorMessages').removeAttr('style');
								$('#registerErrorMessages').fadeOut(2000);
							} else {
								registrationFormData = $('form[id="editTopicForm"]').serialize();
								// alert(registrationFormData);
								submitEditCategory(registrationFormData);
							}
						});
					</script>
				</div>
				<div class='span6'>
					<button id="cancelTopicSubmit" class='btn btn-primary' type='button'>Cancel</button>
					<script>
						$('#cancelTopicSubmit').click(function(e){
							$('#addEditTopicsBlock').load('uploadTopic.php');
						});
					</script>
				</div>
			</div>
		</fieldset>
	</form>

	<script>
		// $( '#editTopic_topic_date' ).datepicker();
	</script>

<?php
} else if (isset($_POST['submit'])){
	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}
	// print_r($_POST);
	// print_r($_FILES['video']);
	if(empty($errors)){

		$id = mysql_real_escape_string(htmlspecialchars($_POST['id']));
		$des = mysql_real_escape_string(htmlspecialchars($_POST['editTopic_topic_description']));
		$cid = mysql_real_escape_string(htmlspecialchars($_POST['editTopic_categories']));
		$tt = mysql_real_escape_string(htmlspecialchars($_POST['editTopic_topic_title']));


		if (isset($_POST['isExample'])){
			$ie = 1;
		} else {
			$ie = 0;
		}
		// $ie = mysql_real_escape_string((htmlspecialchars($_POST['isExample'])));
		
		if(($_FILES['video']['error'] == 0)){	
			$filename = $_FILES['video']['name'];
			$filetype = $_FILES['video']['type'];
			$filesize = $_FILES['video']['size'];
			$filetmpname = $_FILES['video']['tmp_name'];		
		} else {
			$filename = $_POST['video_name'];
			$filetype = $_POST['video_type'];
			$filesize = $_POST['video_size'];
			$filetmpname = $_POST['video_temp_name'];		
		}

		$newTopic = Topic::newTopic($cid,$des,$tt, $_SESSION['user_id'], $ie, $filename, $filesize, $filetype, $filetmpname);
		move_uploaded_file($newTopic->temp_name, "/Applications/XAMPP/xamppfiles/htdocs/ToastmasterLibrary/videos/" . $newTopic->name);		

		$newTopic->id = $id;
		if($newTopic->save()){
			// redirect_to("userRoleListing.php");
		} else {
			die("Cannot update topic. " . mysql_error());
		}
	} else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
		echo '</br>' . $_FILES['video']['error'] . '</br>';
	}
}

?>
<script>
	function submitTopicEditData(formData){
		$('form[id="editTopicForm"]').ajaxSubmit({
			type:'POST',
			url: 'editTopic.php',
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Topic modified!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#topics").load("topicALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Topic could not be modified.</div>');
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="editTopicForm"]')[0].reset();
			}
		});
	};
</script>